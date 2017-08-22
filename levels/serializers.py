from rest_framework import serializers
from levels.models import Levels
class LevelsSerialiser ( serializers.ModelSerializer) :

    class Meta:
        model = Levels
        fields = ("id", "circuit")