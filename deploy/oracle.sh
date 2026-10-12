#!/usr/bin/env bash
# Instala o site numa VM Ubuntu (Oracle Cloud Always Free ou qualquer VPS).
# Uso, dentro da VM, na pasta do projeto:  DOMINIO=seudominio.com.br ADMIN_TOKEN=... bash deploy/oracle.sh
set -euo pipefail
: "${DOMINIO:?defina DOMINIO=seudominio.com.br}"
: "${ADMIN_TOKEN:?defina ADMIN_TOKEN com 16+ caracteres (ex.: openssl rand -base64 24)}"

sudo apt-get update -y
sudo apt-get install -y docker.io caddy
sudo systemctl enable --now docker

# Firewall da própria VM (na Oracle, libere também 80/443 na Security List da VCN)
sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo sh -c 'command -v netfilter-persistent >/dev/null && netfilter-persistent save || true'

sudo docker build -t eleicoes-ao-vivo .
sudo mkdir -p /srv/eleicoes/data && sudo chown 1000:1000 /srv/eleicoes/data
sudo docker rm -f eleicoes 2>/dev/null || true
sudo docker run -d --name eleicoes --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -v /srv/eleicoes/data:/app/data \
  -e TRUST_PROXY=1 -e PUBLIC_URL="https://${DOMINIO}" -e ADMIN_TOKEN="${ADMIN_TOKEN}" \
  eleicoes-ao-vivo

sed "s/seudominio.com.br/${DOMINIO}/" deploy/Caddyfile | sudo tee /etc/caddy/Caddyfile >/dev/null
sudo systemctl reload caddy

echo "Pronto. Teste: curl -s https://${DOMINIO}/api/status | head -c 300"
echo "Primeiro teste de acesso ao TSE: sudo docker exec eleicoes node scripts/baixar-tse.mjs"
