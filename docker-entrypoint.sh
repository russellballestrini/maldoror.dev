#!/bin/sh
set -e

echo "Starting Maldoror SSH World..."

# Generate SSH host key if it doesn't exist
if [ ! -f "$SSH_HOST_KEY_PATH" ]; then
  echo "Generating SSH host key..."
  ssh-keygen -t ed25519 -f "$SSH_HOST_KEY_PATH" -N ""
  echo "SSH host key generated at $SSH_HOST_KEY_PATH"
fi

# Run database migrations/push
echo "Initializing database schema..."
pnpm db:push

# Start the SSH server
echo "Starting SSH server..."
exec pnpm --filter @maldoror/ssh-world start
