# Image des robots LeadMaker (découverte Google Maps, préparation / envoi de formulaires, e-mails).
# L'image Playwright embarque déjà Chromium et ses dépendances : la version doit suivre requirements.txt.
FROM mcr.microsoft.com/playwright/python:v1.64.1-noble

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY leadmaker_workers ./leadmaker_workers
COPY scripts ./scripts
COPY data/categories.json data/generic.txt ./data/

ENV PYTHONUNBUFFERED=1 HEADLESS=true
CMD ["python", "-m", "leadmaker_workers.main"]
