FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
COPY Logos/web /usr/share/nginx/html/Logos/web
EXPOSE 80
