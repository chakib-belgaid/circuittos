from rest_framework import viewsets

from levels.models import GuidedLevels
from levels.serializers import LevelsSerialiser, Levels, GuidedLevelsSerialiser


class LevelsViewSet(viewsets.ModelViewSet) :
    queryset = Levels.objects.all()
    serializer_class = LevelsSerialiser
# Create your views here.


class GuidedLevelsViewSet(viewsets.ModelViewSet):
    queryset = GuidedLevels.objects.all()
    serializer_class = GuidedLevelsSerialiser
