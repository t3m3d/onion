FROM alpine:3.21

RUN apk add --no-cache su-exec tor \
    && mkdir -p /var/lib/tor/data /var/lib/tor/hidden_service \
    && chown -R tor:tor /var/lib/tor \
    && chmod 0700 /var/lib/tor/data /var/lib/tor/hidden_service

COPY tor/torrc /etc/tor/torrc
COPY docker/tor-entrypoint.sh /usr/local/bin/tor-entrypoint.sh
RUN chmod 0755 /usr/local/bin/tor-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/tor-entrypoint.sh"]
CMD ["tor", "-f", "/etc/tor/torrc"]
