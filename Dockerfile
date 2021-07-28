FROM node:14.17
WORKDIR /app
COPY ["package.json", "yarn.lock", "./"]
RUN yarn install --prod --frozen-lockfile --no-progress
COPY . .
# Need to expose a port to the world so AWS gives the container a public IP
EXPOSE 8080

CMD ["node", "index.js"]