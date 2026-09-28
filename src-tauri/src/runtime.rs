use serde_json::Value;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

pub fn bundled_node_path(resource_dir: &Path, executable_dir: &Path, windows: bool) -> PathBuf {
    if windows {
        resource_dir.join("node.exe")
    } else {
        executable_dir.join("node")
    }
}

pub fn parse_listening_url(line: &str) -> Option<SocketAddr> {
    let trimmed = line.trim();
    let (url, development) = if let Some(url) = trimmed.strip_prefix("➜ Listening on:") {
        (url.trim_start(), false)
    } else if let Some(url) = trimmed.strip_prefix("➜ Local:") {
        (url.trim_start(), true)
    } else {
        return None;
    };
    let authority = url.strip_prefix("http://127.0.0.1:")?;
    let port_text = authority.strip_suffix('/')?;
    let port = port_text.parse::<u16>().ok()?;
    if port == 0 || (development && port != 8082) {
        return None;
    }
    Some(SocketAddr::from(([127, 0, 0, 1], port)))
}

pub fn health_check(address: SocketAddr, timeout: Duration) -> Result<(), String> {
    if !address.ip().is_loopback() || !address.is_ipv4() || address.port() == 0 {
        return Err("Saber server address is not an IPv4 loopback address".to_string());
    }
    let mut stream = TcpStream::connect_timeout(&address, timeout)
        .map_err(|_| "Saber local server is not accepting connections".to_string())?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|_| "Could not configure the local health check".to_string())?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|_| "Could not configure the local health check".to_string())?;
    write!(
        stream,
        "GET /api/v1/health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        address.port()
    )
    .map_err(|_| "Could not request local server health".to_string())?;

    let deadline = Instant::now() + timeout;
    let mut response = Vec::with_capacity(1024);
    let mut completed_chunked_body = None;
    let mut chunk = [0_u8; 1024];
    loop {
        if response.len() >= 8192 {
            return Err("Saber local health response exceeded its size limit".to_string());
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("Saber local health check timed out".to_string());
        }
        stream
            .set_read_timeout(Some(remaining))
            .map_err(|_| "Could not configure the local health check".to_string())?;
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => {
                response.extend_from_slice(&chunk[..count]);
                if let Some(separator) =
                    response.windows(4).position(|window| window == b"\r\n\r\n")
                {
                    let headers = std::str::from_utf8(&response[..separator])
                        .map_err(|_| "Saber local health response was invalid".to_string())?;
                    let body = &response[separator + 4..];
                    let chunked = headers.lines().any(|line| {
                        line.split_once(':').is_some_and(|(name, value)| {
                            name.eq_ignore_ascii_case("transfer-encoding")
                                && value.trim().eq_ignore_ascii_case("chunked")
                        })
                    });
                    if chunked {
                        if let Some(decoded) = decode_chunked(body) {
                            completed_chunked_body = Some(decoded);
                            break;
                        }
                    } else if let Some(content_length) = headers.lines().find_map(|line| {
                        line.split_once(':').and_then(|(name, value)| {
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().parse::<usize>().ok())
                                .flatten()
                        })
                    }) {
                        if content_length > 8192 {
                            return Err(
                                "Saber local health response exceeded its size limit".to_string()
                            );
                        }
                        if body.len() >= content_length {
                            response.truncate(separator + 4 + content_length);
                            break;
                        }
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(_) => return Err("Saber local health check timed out".to_string()),
        }
    }

    let separator = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or_else(|| "Saber local health response was incomplete".to_string())?;
    let headers = std::str::from_utf8(&response[..separator])
        .map_err(|_| "Saber local health response was invalid".to_string())?;
    if !headers
        .lines()
        .next()
        .is_some_and(|line| line.contains(" 200 "))
    {
        return Err("Saber local health check did not return success".to_string());
    }
    let raw_body = &response[separator + 4..];
    let decoded_body = if let Some(decoded) = completed_chunked_body {
        decoded
    } else if headers.lines().any(|line| {
        line.split_once(':').is_some_and(|(name, value)| {
            name.eq_ignore_ascii_case("transfer-encoding")
                && value.trim().eq_ignore_ascii_case("chunked")
        })
    }) {
        decode_chunked(raw_body)
            .ok_or_else(|| "Saber local health response was invalid".to_string())?
    } else {
        raw_body.to_vec()
    };
    let body = std::str::from_utf8(&decoded_body)
        .map_err(|_| "Saber local health response was invalid".to_string())?;
    let value: Value = serde_json::from_str(body)
        .map_err(|_| "Saber local health response was invalid".to_string())?;
    let data = value.get("data").unwrap_or(&value);
    if data.get("status").and_then(Value::as_str) != Some("ok")
        || data.get("apiVersion").and_then(Value::as_str).is_none()
    {
        return Err("Saber local health response did not match the expected contract".to_string());
    }
    Ok(())
}

fn decode_chunked(mut body: &[u8]) -> Option<Vec<u8>> {
    let mut decoded = Vec::new();
    loop {
        let line_end = body.windows(2).position(|window| window == b"\r\n")?;
        let size_text = std::str::from_utf8(&body[..line_end])
            .ok()?
            .split(';')
            .next()?;
        let size = usize::from_str_radix(size_text.trim(), 16).ok()?;
        body = &body[line_end + 2..];
        if size == 0 {
            return Some(decoded);
        }
        if decoded.len().saturating_add(size) > 8192 || body.len() < size + 2 {
            return None;
        }
        decoded.extend_from_slice(&body[..size]);
        if &body[size..size + 2] != b"\r\n" {
            return None;
        }
        body = &body[size + 2..];
    }
}

#[cfg(test)]
mod tests {
    use super::{bundled_node_path, health_check, parse_listening_url};
    use std::path::{Path, PathBuf};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

    const LOCAL_HEALTH_FIXTURE_TIMEOUT: Duration = Duration::from_secs(5);

    #[test]
    fn resolves_packaged_node_from_the_platform_bundle_location() {
        assert_eq!(
            bundled_node_path(Path::new("/usr/lib/Saber"), Path::new("/usr/bin"), false),
            PathBuf::from("/usr/bin/node")
        );
        assert_eq!(
            bundled_node_path(Path::new("C:/Saber"), Path::new("C:/Saber"), true),
            PathBuf::from("C:/Saber/node.exe")
        );
    }

    #[test]
    fn parses_only_expected_loopback_listening_line() {
        assert_eq!(
            parse_listening_url("➜ Listening on: http://127.0.0.1:52799/"),
            Some("127.0.0.1:52799".parse().unwrap())
        );
        assert_eq!(
            parse_listening_url("➜ Local:   http://127.0.0.1:8082/"),
            Some("127.0.0.1:8082".parse().unwrap())
        );
        for line in [
            "➜ Listening on: http://localhost:52799/",
            "➜ Listening on: http://127.0.0.2:52799/",
            "➜ Listening on: http://[::1]:52799/",
            "➜ Listening on: http://127.0.0.1:0/",
            "➜ Listening on: http://127.0.0.1:65536/",
            "➜ Listening on: https://127.0.0.1:52799/",
            "➜ Listening on: http://127.0.0.1:52799",
            "➜ Local: http://127.0.0.1:8083/",
            "unrelated output",
        ] {
            assert_eq!(parse_listening_url(line), None, "{line}");
        }
    }

    fn fixture(status: &str, body: &str, chunked: bool) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.2:0").unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_string();
        let body = body.to_string();
        let handle = thread::spawn(move || {
            let mut stream = loop {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_millis(250)))
                    .unwrap();
                let mut request = [0_u8; 512];
                match stream.read(&mut request) {
                    Ok(count)
                        if request[..count].starts_with(b"GET /api/v1/health HTTP/") =>
                    {
                        break stream;
                    }
                    Ok(_) => {}
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock
                                | std::io::ErrorKind::TimedOut
                                | std::io::ErrorKind::Interrupted
                        ) => {}
                    Err(_) => {}
                }
            };
            if chunked {
                let midpoint = body.len() / 2;
                let (first, second) = body.split_at(midpoint);
                write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{first}\r\n{:x}\r\n{second}\r\n0\r\n\r\n", first.len(), second.len()).unwrap();
                stream.flush().unwrap();
                thread::sleep(Duration::from_secs(2));
            } else {
                write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
        });
        (address.to_string(), handle)
    }

    #[test]
    fn accepts_only_successful_minimal_health_contract() {
        let (address, server) = fixture(
            "200 OK",
            r#"{"data":{"status":"ok","apiVersion":"1.0.0"}}"#,
            false,
        );
        let result = health_check(address.parse().unwrap(), LOCAL_HEALTH_FIXTURE_TIMEOUT);
        server.join().unwrap();
        assert!(result.is_ok(), "content-length fixture at {address}: {result:?}");

        let (address, server) = fixture(
            "200 OK",
            r#"{"data":{"status":"ok","apiVersion":"1.0.0"}}"#,
            true,
        );
        let result = health_check(address.parse().unwrap(), LOCAL_HEALTH_FIXTURE_TIMEOUT);
        server.join().unwrap();
        assert!(result.is_ok(), "chunked fixture at {address}: {result:?}");

        for (status, body) in [
            (
                "503 Unavailable",
                r#"{"data":{"status":"ok","apiVersion":"1.0.0"}}"#,
            ),
            (
                "200 OK",
                r#"{"data":{"status":"fail","apiVersion":"1.0.0"}}"#,
            ),
            ("200 OK", r#"{"data":{"status":"ok"}}"#),
            ("200 OK", "not-json"),
        ] {
            let (address, server) = fixture(status, body, false);
            assert!(health_check(address.parse().unwrap(), LOCAL_HEALTH_FIXTURE_TIMEOUT).is_err());
            server.join().unwrap();
        }
    }

    #[test]
    fn rejects_refused_and_timed_out_health_connections() {
        let listener = TcpListener::bind("127.0.0.2:0").unwrap();
        let refused_address = listener.local_addr().unwrap();
        drop(listener);
        assert!(health_check(refused_address, Duration::from_millis(200)).is_err());

        let listener = TcpListener::bind("127.0.0.2:0").unwrap();
        let timeout_address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 512];
            let _ = stream.read(&mut request);
            thread::sleep(Duration::from_millis(250));
        });
        assert!(health_check(timeout_address, Duration::from_millis(50)).is_err());
        server.join().unwrap();
    }
}
