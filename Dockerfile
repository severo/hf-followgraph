FROM node:19
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci
RUN npm rebuild
COPY . ./
RUN npm run build
RUN npm run start
