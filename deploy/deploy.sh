#!/bin/bash
set -e

# Configuration
SERVER="root@134.199.180.251"
DEPLOY_DIR="/opt/maldoror"
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Maldoror Deploy Script ==="
echo "Server: $SERVER"
echo "Deploy dir: $DEPLOY_DIR"
echo ""

# Check for .env.prod file
if [ ! -f "$PROJECT_ROOT/deploy/.env.prod" ]; then
    echo "ERROR: deploy/.env.prod not found!"
    echo "Create it with:"
    echo "  POSTGRES_PASSWORD=your_secure_password"
    echo "  AI_PROVIDER=anthropic"
    echo "  ANTHROPIC_API_KEY=your_key"
    exit 1
fi

echo ">>> Installing Docker on server (if needed)..."
ssh $SERVER 'which docker || (apt-get update && apt-get install -y docker.io docker-compose-v2 && systemctl enable docker && systemctl start docker)'

echo ">>> Creating deploy directory..."
ssh $SERVER "mkdir -p $DEPLOY_DIR"

echo ">>> Syncing project files..."
rsync -avz --delete \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'dist' \
    --exclude '.env' \
    --exclude '.env.local' \
    --exclude 'deploy/.env.prod' \
    "$PROJECT_ROOT/" "$SERVER:$DEPLOY_DIR/"

echo ">>> Copying production env file..."
scp "$PROJECT_ROOT/deploy/.env.prod" "$SERVER:$DEPLOY_DIR/.env"

echo ">>> Building and starting containers..."
ssh $SERVER "cd $DEPLOY_DIR && docker compose -f deploy/docker-compose.prod.yml up -d --build"

echo ">>> Waiting for services to start..."
sleep 5

echo ">>> Checking service status..."
ssh $SERVER "cd $DEPLOY_DIR && docker compose -f deploy/docker-compose.prod.yml ps"

echo ""
echo "=== Deploy Complete ==="
echo "SSH server should be available at: ssh -p 2222 $SERVER"
echo "Or configure your domain to point to 134.199.180.251"
