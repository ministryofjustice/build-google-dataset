FROM node:23-alpine AS base-node

COPY --chown=node:node ./ /home/node/

WORKDIR /home/node/

RUN chmod +x ./bin/app-install.sh


FROM base-node AS dev

RUN mkdir -p /home/node/node_modules && \
    chown -R node:node /home/node

RUN npm i nodemon -g

USER 1000

ENTRYPOINT ["ash", "-c", "/home/node/bin/app-install.sh"]


FROM base-node AS build-prod

RUN npm i

USER 1000

ENTRYPOINT ["ash", "-c", "npm run start"]
