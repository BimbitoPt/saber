# Saber dev image (web UI). Tauri desktop build needs a separate toolchain.
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies first (cache-friendly)
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

EXPOSE 8082
ENV HOST=0.0.0.0
# The container exists to serve the UI from another machine, so the
# loopback-only API gate must be explicitly relaxed here.
ENV SABER_ALLOW_REMOTE_API=1
CMD ["bun", "run", "dev", "--", "--host", "0.0.0.0", "--port", "8082", "--strictPort"]
