# -*- coding: utf-8 -*-
# Generated by Django 1.11.4 on 2017-09-05 01:29
from __future__ import unicode_literals

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('levels', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='Choice',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('answer', models.CharField(max_length=100)),
            ],
        ),
        migrations.CreateModel(
            name='GuidedLevels',
            fields=[
                ('levels_ptr',
                 models.OneToOneField(auto_created=True, on_delete=django.db.models.deletion.CASCADE, parent_link=True,
                                      primary_key=True, serialize=False, to='levels.Levels')),
                ('parts', models.CharField(max_length=5000)),
                ('labels', models.CharField(max_length=1000)),
            ],
            bases=('levels.levels',),
        ),
        migrations.CreateModel(
            name='Question',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('question', models.CharField(max_length=1000)),
                ('creation_date', models.DateField(auto_now=True)),
            ],
        ),
        migrations.RemoveField(
            model_name='levels',
            name='num',
        ),
        migrations.AddField(
            model_name='levels',
            name='creation_date',
            field=models.DateField(auto_now=True),
        ),
        migrations.AddField(
            model_name='levels',
            name='difficulty',
            field=models.IntegerField(default=True, unique=True),
        ),
        migrations.AlterField(
            model_name='levels',
            name='circuit',
            field=models.CharField(max_length=10000),
        ),
        migrations.AddField(
            model_name='choice',
            name='question',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='levels.Question'),
        ),
    ]
