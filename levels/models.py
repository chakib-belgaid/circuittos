from django.db import models


# Create your models here.
class Levels(models.Model):
    circuit = models.CharField(max_length=10000)
    creation_date = models.DateField(auto_now=True)
    difficulty = models.IntegerField(unique=True, default=True)
    # user = models.ForeignKey("AppUser", null=False)


class GuidedLevels(Levels):
    parts = models.CharField(max_length=5000)  # predifined parts
    labels = models.CharField(max_length=1000)  # the labels who got the value of the circuit that we should get


class Question(models.Model):
    question = models.CharField(max_length=1000)
    creation_date = models.DateField(auto_now=True)


class Choice(models.Model):
    answer = models.CharField(max_length=100)
    question = models.ForeignKey(Question, on_delete=models.CASCADE)
