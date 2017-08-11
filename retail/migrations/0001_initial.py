# -*- coding: utf-8 -*-
# Generated by Django 1.11.4 on 2017-08-11 01:02
from __future__ import unicode_literals

import django.core.validators
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='Chain',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('description', models.CharField(max_length=1000)),
                ('slogan', models.CharField(max_length=500)),
                ('founded_date', models.CharField(max_length=500)),
                ('website', models.URLField(max_length=500)),
            ],
        ),
        migrations.CreateModel(
            name='Employee',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('number', models.CharField(max_length=20)),
                ('first_name', models.CharField(max_length=100)),
                ('last_name', models.CharField(max_length=100)),
                ('hired_date', models.DateTimeField(default=django.utils.timezone.now)),
            ],
        ),
        migrations.CreateModel(
            name='Store',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('number', models.CharField(max_length=20)),
                ('address', models.CharField(max_length=1000)),
                ('opening_date', models.DateTimeField(default=django.utils.timezone.now)),
                ('business_hours_start', models.IntegerField(default=8, validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(23)])),
                ('business_hours_end', models.IntegerField(default=17, validators=[django.core.validators.MinValueValidator(0), django.core.validators.MaxValueValidator(23)])),
                ('chain', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='retail.Chain')),
            ],
        ),
        migrations.AddField(
            model_name='employee',
            name='store',
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to='retail.Store'),
        ),
    ]
