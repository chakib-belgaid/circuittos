from django.db import models


# Create your models here.
class Levels(models.Model):
    circuit = models.CharField(max_length=10000)


class GuidedLevels(models.Model):
    circuit = models.CharField(max_length=10000)
    parts = models.CharField(max_length=5000)  # predifined parts
    labels = models.CharField(max_length=1000)  # the labels who got the value of the circuit that we should get
