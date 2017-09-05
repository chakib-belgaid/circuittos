from rest_framework import serializers

from levels.models import *


class LevelsSerialiser ( serializers.ModelSerializer) :

    class Meta:
        model = Levels
        fields = ("id", "circuit", "creation_date", "difficulty")


class GuidedLevelsSerialiser(LevelsSerialiser):
    class Meta:
        model = GuidedLevels
        fields = ("parts", "labels")


class QuestionSerialiser(serializers.ModelSerializer):
    class Meta:
        model = Question
        fields = ('id', 'question', 'creation_date')
