from rest_framework import serializers

from levels.models import Levels, GuidedLevels


class LevelsSerialiser ( serializers.ModelSerializer) :

    class Meta:
        model = Levels
        fields = ("id", "circuit")


class GuidedLevelsSerialiser(serializers.ModelSerializer):
    class Meta:
        model = GuidedLevels
        fields = ("id", "circuit", "parts", "labels")
