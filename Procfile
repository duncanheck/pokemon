web: gunicorn cardvault.wsgi --workers 2 --threads 2 --log-file -
worker: celery -A cardvault worker --loglevel=info --concurrency=2
beat: celery -A cardvault beat --loglevel=info --scheduler django_celery_beat.schedulers:DatabaseScheduler
