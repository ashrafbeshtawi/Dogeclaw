FROM flyway/flyway:11-alpine

# Bake the SQL files into the image — consumers don't need to mount anything,
# they just point this image at a database via FLYWAY_URL/USER/PASSWORD.
COPY sql/ /flyway/sql/

# Dogeclaw-specific defaults so the image is self-configuring.
# Uses its own history table to coexist with other Flyway services on the
# same database/schema.
ENV FLYWAY_TABLE=dogeclaw_flyway_history \
    FLYWAY_BASELINE_ON_MIGRATE=true \
    FLYWAY_BASELINE_VERSION=0 \
    FLYWAY_CONNECT_RETRIES=10

# Inherits ENTRYPOINT=["/flyway/flyway"] from the base image, so this becomes
# `flyway migrate` at runtime.
CMD ["migrate"]
