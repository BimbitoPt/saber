use std::sync::Mutex;

/// The port of the loopback server whose origin the WebView is allowed to show.
/// The server binds to an ephemeral port in production, so the trusted origin is
/// resolved at startup and stored here instead of being hardcoded.
pub struct ServerOrigin(Mutex<u16>);

impl ServerOrigin {
    pub fn new(port: u16) -> Self {
        Self(Mutex::new(port))
    }

    pub fn port(&self) -> u16 {
        *self.0.lock().unwrap()
    }
}

/// Whether `url` is exactly the Saber server origin on loopback.
///
/// The capability file must grant terminal IPC to a wildcard loopback origin
/// because the packaged server binds an ephemeral port. This check is the real
/// trust boundary: a page served by any other local service, or any non-http
/// origin, is rejected even when the capability would allow it.
pub fn origin_allowed(url: &str, expected_port: u16) -> bool {
    let Some(rest) = url.strip_prefix("http://127.0.0.1") else {
        return false;
    };
    let after_host = rest.strip_prefix(':').unwrap_or(rest);
    let end = after_host
        .find(['/', '?', '#'])
        .unwrap_or(after_host.len());
    // An omitted port means the URL default; the Saber server never serves
    // anything but http on the port it announced at startup.
    let port: u16 = if after_host[..end].is_empty() {
        80
    } else {
        match after_host[..end].parse() {
            Ok(parsed) => parsed,
            Err(_) => return false,
        }
    };
    port == expected_port
}

/// Reject terminal commands that do not come from the window showing the Saber
/// server origin.
pub fn ensure_trusted_origin(
    webview: &tauri::WebviewWindow,
    origin: &ServerOrigin,
) -> Result<(), String> {
    let expected = origin.port();
    let url = webview
        .url()
        .map_err(|_| "Saber could not verify the requesting window origin".to_string())?;
    if origin_allowed(url.as_str(), expected) {
        Ok(())
    } else {
        Err("Terminal commands are restricted to the Saber application origin".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::origin_allowed;

    #[test]
    fn allows_only_the_exact_saber_server_origin() {
        assert!(origin_allowed("http://127.0.0.1:8082/", 8082));
        assert!(origin_allowed("http://127.0.0.1:49152/api/sessions?x=1", 49152));
        assert!(origin_allowed("http://127.0.0.1:8082", 8082));
        assert!(origin_allowed("http://127.0.0.1/", 80));
    }

    #[test]
    fn rejects_every_other_origin() {
        assert!(!origin_allowed("http://127.0.0.1:9999/", 8082));
        assert!(!origin_allowed("http://localhost:8082/", 8082));
        assert!(!origin_allowed("http://[::1]:8082/", 8082));
        assert!(!origin_allowed("https://127.0.0.1:8082/", 8082));
        assert!(!origin_allowed("http://example.com:8082/", 8082));
        assert!(!origin_allowed("tauri://localhost/", 8082));
        assert!(!origin_allowed("http://127.0.0.1.evil.com:8082/", 8082));
        assert!(!origin_allowed("not a url", 8082));
        assert!(!origin_allowed("", 8082));
    }
}
