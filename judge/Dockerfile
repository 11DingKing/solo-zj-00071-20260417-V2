FROM node:16-alpine

WORKDIR /app

RUN apk update && apk add --no-cache \
    g++ \
    gcc \
    python3 \
    bash \
    coreutils \
    && rm -rf /var/cache/apk/*

RUN npm config set registry https://registry.npmmirror.com

COPY package*.json ./

RUN npm install

COPY . .

RUN mkdir -p /app/submissions

EXPOSE 8081

CMD ["npm", "start"]
