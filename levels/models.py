from django.db import models

# Create your models here.
class Levels(models.Model) :
    circuit = models.CharField(max_length = 2500)

class Guided_Levels(models.Model) :
    circuit = models.CharField(max_length = 2500)
    custom_parts =models.CharField(max_length = 1000)
