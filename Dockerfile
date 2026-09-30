FROM python:3.11-slim

# Establecer el directorio de trabajo dentro del contenedor
WORKDIR /app

# Dependencias del sistema: curl para el multipart de adjuntos a Remedy.
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copiar el archivo de dependencias e instalar los paquetes
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el resto del código
COPY . .

# Variables de entorno por defecto para el contenedor
ENV HOST=0.0.0.0
ENV PORT=5000
ENV FLASK_ENV=production
ENV DOCKER_ENV=1

# Exponer el puerto
EXPOSE 5000

# Gunicorn: UN worker multi-thread (no varios procesos).
# El estado en memoria del proceso (cache de Remedy en queries.py y las
# credenciales para renovar el token en servicios/remedy_session.py) NO se
# comparte entre procesos. Con varios workers cada uno tiene su cache frio,
# multiplicando las llamadas a Remedy y rompiendo la renovacion del token.
# La app es I/O-bound (espera a Remedy y SQLite), no CPU-bound: los threads
# liberan el GIL durante el I/O de socket, asi que un proceso con muchos
# hilos da la concurrencia necesaria y mantiene el cache compartido.
# Sin --preload para que el worker corra el codigo de arranque (init_db,
# backfill) en su propio proceso y no en el master.
CMD ["gunicorn", "-w", "1", "--threads", "16", "-b", "0.0.0.0:5000", "--timeout", "120", "Backend.main:app"]
