FROM nginx:1.27-alpine

COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/10-onion-host.envsh /docker-entrypoint.d/10-onion-host.envsh
RUN chmod 0755 /docker-entrypoint.d/10-onion-host.envsh
