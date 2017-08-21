from django.shortcuts import render
from rest_framework import viewsets

from levels.serializers import  LevelsSerialiser , Levels

class LevelsViewSet(viewsets.ModelViewSet) :
    queryset = Levels.objects.all()
    serializer_class = LevelsSerialiser
# Create your views here.
