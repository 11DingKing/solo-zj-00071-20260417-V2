FROM node:16-alpine

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com

COPY package*.json ./

RUN npm install --verbose

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
