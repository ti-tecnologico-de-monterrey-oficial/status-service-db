# Imagen del status-service-db: servicio Express que mantiene las listas de
# estado de las credenciales en MongoDB.
#
# El contexto de build es la raíz del repositorio.
#
# Aquí no se compila nada: toda la configuración (puerto, conexión a la base,
# semilla DID, niveles de log) se lee de variables de entorno en el arranque,
# así que la misma imagen sirve para cualquier ambiente y no hay --build-arg
# que pasar.

FROM node:22-alpine AS deps

WORKDIR /app

# Los manifiestos antes que el código, para que la capa de dependencias solo se
# reconstruya cuando cambia el lockfile.
COPY package.json package-lock.json ./
COPY patches ./patches

# --omit=peer: @digitalcredentials/bnid depende de react-native-securerandom,
# cuyo peer es react-native completo —con hermes, metro y babel: 175 MB que
# cuadruplican la imagen—. bnid solo toma ese camino cuando corre dentro de una
# app móvil; en Node usa el crypto de la plataforma y nunca lo importa.
RUN npm ci --omit=peer

# Verificar que el parche Bitstring se aplicó correctamente.
RUN grep -q "131072" \
    node_modules/@digitalcredentials/credential-status-manager-db/dist/credential-status-manager-base.js

# Eliminar dependencias de desarrollo.
RUN npm prune --omit=dev --omit=peer --ignore-scripts

# Verificar que el parche se conserva después de npm prune.
RUN grep -q "131072" \
    node_modules/@digitalcredentials/credential-status-manager-db/dist/credential-status-manager-base.js

FROM node:22-alpine AS runtime

# tini como PID 1: reenvía SIGTERM al proceso de Node cuando Container Apps
# retira una revisión —Node no lo atiende por sí solo siendo PID 1— y recoge
# los procesos huérfanos.
RUN apk add --no-cache tini

# El puerto viaja en la imagen en lugar de quedar en la configuración del
# Container App: config.js cae a 4008 si PORT no está definido, y esa
# diferencia con el targetPort del ingress no se nota hasta que el contenedor
# está arriba y no responde.
#
# ENABLE_HTTPS_FOR_DEV se apaga explícitamente porque en este servicio su
# default es true: sin esto, server.js busca server-dev-only.key —que no viaja
# en la imagen— en lugar de escuchar http. En Container Apps el TLS lo termina
# el ingress, así que el servidor siempre habla http.
ENV NODE_ENV=production \
    PORT=4008 \
    ENABLE_HTTPS_FOR_DEV=false

WORKDIR /app

# Los archivos quedan a nombre de root y el proceso corre como node, de modo
# que la aplicación no puede reescribir su propio código.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json server.js ./
COPY src ./src

# El logger solo abre archivos si ERROR_LOG_FILE o ALL_LOG_FILE están
# definidos, y esas rutas son relativas al WORKDIR. El directorio se crea aquí
# y a nombre de node para que definirlas no reviente con EACCES.
RUN mkdir logs && chown node:node logs

USER node

EXPOSE 4008

ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "server.js"]
