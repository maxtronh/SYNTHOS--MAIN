# Fable Engine v3 - Path B Managed Stateful Sandbox
# Ephemeral PostgreSQL / Kafka / Prisma dry-run environment with guaranteed cleanup
FROM node:22-alpine

WORKDIR /sandbox-stateful

# Install postgresql client for schema management & migration verification
RUN apk add --no-cache postgresql-client bash

# Create unprivileged runner user
RUN addgroup -S runner && adduser -S runner -G runner

# Copy teardown verification script
COPY cleanup.sh /usr/local/bin/cleanup.sh
RUN chmod +x /usr/local/bin/cleanup.sh 2>/dev/null || true

USER runner

ENTRYPOINT ["/bin/bash"]
CMD ["-c", "echo 'Stateful sandbox ready'"]
