#!/bin/bash
# Run a SQL query on the production database
# Usage: ./deploy/prod-query.sh "SELECT * FROM users;"

if [ -z "$1" ]; then
    echo "Usage: $0 \"SQL QUERY\""
    echo "Example: $0 \"SELECT * FROM users;\""
    exit 1
fi

ssh -p 22022 root@134.199.180.251 "docker exec deploy-postgres-1 psql -U maldoror -d maldoror -c '$1'"
