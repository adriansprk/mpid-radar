FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY site/ /usr/share/nginx/html/
# Serve the published data files from the same domain (e.g. /data/latest.json).
COPY data/ /usr/share/nginx/html/data/

EXPOSE 80
