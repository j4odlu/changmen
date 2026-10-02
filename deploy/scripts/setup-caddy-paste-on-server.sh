# One-shot: paste entire file into VPS Workbench (root shell).
# 若仓库不在 /root/changmen，先改下面 root 路径。
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
{
	auto_https off
}

:80 {
	encode gzip

	root * /root/changmen/client/web/dist

	@health path /health /health/pm-market
	handle @health {
		reverse_proxy 127.0.0.1:3456
	}
	handle /esport/ws-forward/PM-MARKET* {
		reverse_proxy 127.0.0.1:3457
	}
	handle /esport/ws-forward/PREDICTFUN-MARKET* {
		reverse_proxy 127.0.0.1:3458
	}
	handle /esport/ws-forward/PM-SPORT-MARKET* {
		reverse_proxy 127.0.0.1:3459
	}
	handle /esport/ws-forward/SXBET-MARKET* {
		reverse_proxy 127.0.0.1:3460
	}
	handle /esport/* {
		reverse_proxy 127.0.0.1:3456
	}
	handle /common/* {
		reverse_proxy 127.0.0.1:3456
	}
	handle /api/* {
		reverse_proxy 127.0.0.1:3456
	}
	handle /esport2/* {
		reverse_proxy 127.0.0.1:3456
	}
	@matcher path /matcher /matcher/*
	handle @matcher {
		reverse_proxy 127.0.0.1:3456
	}
	handle /v4.0/* {
		reverse_proxy 127.0.0.1:3456
	}

	@spa_html path / /index.html
	header @spa_html Cache-Control "no-cache, no-store, must-revalidate"

	@hashed_assets path /assets/*
	header @hashed_assets Cache-Control "public, max-age=31536000, immutable"

	handle {
		try_files {path} /index.html
		file_server
	}
}
EOF
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
pm2 status || true
curl -s -o /dev/null -w "node_3456=%{http_code}\n" http://127.0.0.1:3456/
curl -s -o /dev/null -w "caddy_80=%{http_code}\n" http://127.0.0.1/
echo "Open http://YOUR_VPS_IP/ (changmen login)"
