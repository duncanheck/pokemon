web: gunicorn cardvault.wsgi:application --log-file -
worker: celery -A cardvault worker --loglevel=info
beat: celery -A cardvault beat --loglevel=info
