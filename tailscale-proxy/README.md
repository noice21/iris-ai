# Iris AI Tailscale Proxy

This Docker container provides secure remote access to your Iris AI backend and Media Dashboard through Tailscale, without requiring Tailscale to be installed on your host machine.

## Architecture

```
Client (on Tailscale)
    ↓
Tailscale Network (100.71.195.127)
    ↓
Nginx Reverse Proxy (in Tailscale container)
    ↓
    ├─ Port 3001 → localhost:3001 (Iris AI Backend)
    ├─ Port 3000 → localhost:3000 (Media Dashboard Backend API)
    └─ Port 3002 → localhost:3002 (Media Dashboard Frontend)
```

## Setup Instructions

### 1. Get a Tailscale Auth Key

1. Go to [Tailscale Admin Console](https://login.tailscale.com/admin/settings/keys)
2. Click "Generate auth key"
3. Configure the key:
   - **Reusable**: ✅ Yes
   - **Ephemeral**: ❌ No (so it persists across restarts)
   - **Tags**: Add `iris` (or create a custom tag)
   - **Expiration**: 90 days or longer
4. Copy the generated key (starts with `tskey-auth-...`)

### 2. Configure Environment

```bash
cd tailscale-proxy
cp .env.example .env
```

Edit `.env` and add your Tailscale auth key:
```env
TS_AUTHKEY=tskey-auth-your-actual-key-here
```

### 3. Start the Proxy

```bash
docker-compose up -d
```

Check logs to verify it's working:
```bash
docker-compose logs -f
```

You should see:
```
Waiting for Tailscale to connect...
Tailscale IP: 100.x.x.x
Starting Nginx reverse proxy...
```

### 4. Find Your Tailscale IP

```bash
docker exec iris-tailscale-proxy tailscale ip -4
```

This will show your Tailscale IP (e.g., `100.90.70.75`)

### 5. Test Connection

From another device on your Tailscale network (replace `100.71.195.127` with your actual Tailscale IP):

```bash
# Test Iris AI backend
curl http://100.71.195.127:3001/health

# Test Media Dashboard backend
curl http://100.71.195.127:3000/health

# Test WebSocket (using websocat or similar)
websocat ws://100.71.195.127:3001/ws
```

**Browser Access:**
- **Iris AI Backend:** `http://100.71.195.127:3001`
- **Media Dashboard API:** `http://100.71.195.127:3000`
- **Media Dashboard Frontend:** `http://100.71.195.127:3002`

## Service Ports

| Service | Port | Description |
|---------|------|-------------|
| Iris AI Backend | 3001 | WebSocket + REST API for voice assistant |
| Media Dashboard API | 3000 | REST API for Docker container management |
| Media Dashboard Frontend | 3002 | Web UI for media dashboard |

## Flutter Client Configuration

Your Flutter app needs to know when to use Tailscale vs local connection. The Tailscale IP is already configured in `iris_websocket_service.dart`:
```dart
static const String _tailscaleUrl = 'ws://100.71.195.127:3001/ws';
```

## Troubleshooting

### Container won't start
- Check your Tailscale auth key is valid
- Ensure the key is reusable and not expired
- Check logs: `docker-compose logs`

### Can't connect from other devices
- Verify the device is on your Tailscale network
- Check firewall rules on host machine
- Ensure backend is running on port 3001

### WebSocket disconnections
- Check Nginx logs: `docker exec iris-tailscale-proxy cat /var/log/nginx/error.log`
- Verify backend is healthy: `curl http://localhost:3001/health`

### View Tailscale status
```bash
docker exec iris-tailscale-proxy tailscale status
```

## Maintenance

### Update Tailscale
```bash
docker-compose pull
docker-compose up -d
```

### View logs
```bash
# All logs
docker-compose logs -f

# Nginx access logs
docker exec iris-tailscale-proxy tail -f /var/log/nginx/access.log

# Nginx error logs
docker exec iris-tailscale-proxy tail -f /var/log/nginx/error.log
```

### Restart
```bash
docker-compose restart
```

### Stop
```bash
docker-compose down
```

## Security Notes

- The Tailscale auth key is sensitive - keep `.env` file secure
- Add `.env` to `.gitignore` (already done)
- Consider using Tailscale ACLs to restrict access
- This setup only exposes port 3001 on the Tailscale network (not public internet)

## Advanced Configuration

### Change Backend Port

If your backend runs on a different port, edit `nginx.conf`:
```nginx
upstream iris_backend {
    server 127.0.0.1:YOUR_PORT;
}
```

### Add SSL/TLS

Tailscale already encrypts all traffic, but if you want HTTPS:
1. Add certificates to the container
2. Update nginx.conf to listen on 443
3. Add SSL configuration

### Multiple Backends

You can proxy multiple services by adding more location blocks in `nginx.conf`.
