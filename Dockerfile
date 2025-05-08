#░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░
#░░
#░░     ▀█▀ █▀▄▀█ █▀▀█ █▀▀▀ █▀▀ 　 ▒█▀▀█ █▀▀█ █▀▀▄ █▀▀ ░▀░ █▀▀▀
#░░     ▒█░ █░▀░█ █▄▄█ █░▀█ █▀▀ 　 ▒█░░░ █░░█ █░░█ █▀▀ ▀█▀ █░▀█
#░░     ▄█▄ ▀░░░▀ ▀░░▀ ▀▀▀▀ ▀▀▀ 　 ▒█▄▄█ ▀▀▀▀ ▀░░▀ ▀░░ ▀▀▀ ▀▀▀▀
#░░
#░░    (¯`v´¯)
#░░     `.¸.[Code]
#░░
#░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░

FROM node:23-alpine AS base-node

# Set the environment to development, as we will install
# npm development dependencies in both child images.
ENV NODE_ENV=development

COPY --chown=node:node ./ /home/node/
WORKDIR /home/node/

## ensure install is executable
RUN chmod +x ./bin/app-install.sh


#
#   ▒█▀▀▄ █▀▀ ▀█░█▀ █▀▀ █░░ █▀▀█ █▀▀█ █▀▄▀█ █▀▀ █▀▀▄ ▀▀█▀▀
#   ▒█░▒█ █▀▀ ░█▄█░ █▀▀ █░░ █░░█ █░░█ █░▀░█ █▀▀ █░░█ ░░█░░
#   ▒█▄▄▀ ▀▀▀ ░░▀░░ ▀▀▀ ▀▀▀ ▀▀▀▀ █▀▀▀ ▀░░░▀ ▀▀▀ ▀░░▀ ░░▀░░
#
#   ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░

FROM base-node AS dev

RUN mkdir -p /home/node/node_modules && \
    chown -R node:node /home/node

RUN npm i nodemon -g

USER 1000

ENTRYPOINT ["ash", "-c", "/home/node/bin/app-install.sh"]


#
#   ▒█▀▀█ █▀▀█ █▀▀█ █▀▀▄ █░░█ █▀▀ ▀▀█▀▀ ░▀░ █▀▀█ █▀▀▄
#   ▒█▄▄█ █▄▄▀ █░░█ █░░█ █░░█ █░░ ░░█░░ ▀█▀ █░░█ █░░█
#   ▒█░░░ ▀░▀▀ ▀▀▀▀ ▀▀▀░ ░▀▀▀ ▀▀▀ ░░▀░░ ▀▀▀ ▀▀▀▀ ▀░░▀
#
#   ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░  ░░

FROM base-node AS build-prod

RUN npm ci && \
    # Run the gulp build script
    npm run build && \
    # Remove dev dependencies
    npm prune --production

# Change the environment to production for runtime.
ENV NODE_ENV=production

USER 1000

# Execute NodeJS (not NPM script) to handle SIGTERM and SIGINT signals.
CMD ["node", "dist/index.js"]
