FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY index.html favicon.svg favicon.png favicon.ico /usr/share/nginx/html/
COPY social /usr/share/nginx/html/social
COPY Logos/web /usr/share/nginx/html/Logos/web
EXPOSE 80
