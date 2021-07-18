FROM node:14.17
WORKDIR /app
COPY ["package.json", "yarn.lock", "./"]
RUN yarn install --prod --frozen-lockfile --no-progress
COPY . .
CMD ["node", "index.js"]