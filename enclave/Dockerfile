FROM node:22-alpine
WORKDIR /enclave
COPY package.json ./
RUN npm install --omit=dev
COPY deterministic.mjs teesign.mjs enclave-node.mjs inputs.json ./
ENTRYPOINT ["node", "enclave-node.mjs"]
