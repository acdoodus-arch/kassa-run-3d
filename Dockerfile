FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server ./server
COPY static ./static
ENV HOST=0.0.0.0 PORT=8080 KASSA_TRUST_PROXY=1
VOLUME /app/data
EXPOSE 8080
CMD ["python", "server/app.py"]
