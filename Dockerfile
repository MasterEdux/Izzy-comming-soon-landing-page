FROM nginx:alpine
COPY index.html favicon.svg favicon.png favicon.ico /usr/share/nginx/html/
COPY Logos/web /usr/share/nginx/html/Logos/web
EXPOSE 80
