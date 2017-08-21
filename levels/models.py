from django.db import models

# Create your models here.
class Levels(models.Model) :
    num = models.IntegerField()
    circuit = models.CharField(max_length = 2500)

