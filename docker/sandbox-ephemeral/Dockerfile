# Fable Engine v3 - Path A Ephemeral Sandbox
# Pure code execution with disposable filesystem and egress boundaries
FROM node:22-alpine

WORKDIR /sandbox

# Create unprivileged runner user
RUN addgroup -S runner && adduser -S runner -G runner

# Ensure disposable directory permissions
RUN chown -R runner:runner /sandbox

USER runner

ENTRYPOINT ["npm"]
CMD ["test"]
