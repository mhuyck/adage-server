#!/usr/bin/env python

'''
Load activity spreadsheet (generated by Jie) into the database.
This module should be invoked as a management command:

    python manage.py import_activity <activity_fielname> <ml_model_name>

<activity_filename> should be a tab-delimited activity spreadsheet;
<ml_model_name> should be the machine learning model name that corresponds to
<activity_filename>.
'''

from __future__ import print_function
import argparse
from django.core.management.base import BaseCommand, CommandError
from analyze.models import Sample, MLModel, Node, Activity

import logging
logger = logging.getLogger(__name__)
logger.addHandler(logging.NullHandler())


class Command(BaseCommand):
    help = 'Imports data to initialize the database with MLModel, Node '\
           'and Activity records.'

    def add_arguments(self, parser):
        parser.add_argument('activity_file', type=argparse.FileType('r'))
        parser.add_argument('ml_model_name', type=str)

    def handle(self, **options):
        try:
            import_activity(options['activity_file'], options['ml_model_name'])
            self.stdout.write(self.style.NOTICE(
                "Activity data import succeeded"))
        except Exception as e:
            raise CommandError(
                "Data import encountered an error: import_activity "
                "threw an exception:\n%s" % e)


def valid_node_names(nodes, ml_model_name):
    '''
    Check node names on the first line of the input file.

    This function will generate an error message and return False if any of the
    following are detected:
      (1) Node name is blank (null or consists of space characters only);
      (2) Node name is duplicate;
      (3) The combination of Node name and given ml_model_name is not unique.
    Return True otherwise.
    '''

    node_set = set()
    for index, name in enumerate(nodes):
        if not name or name.isspace():
            logger.error("Input file line #1 column #%d: blank node name",
                         index + 2)
            return False
        elif name in node_set:
            logger.error("Input file line #1 column #%d: %s is NOT unique",
                         index + 2, name)
            return False
        elif Node.objects.filter(name=name,
                                 mlmodel__title=ml_model_name).exists():
            logger.error("Input file line #1 column #%d: Node name already "
                         "exists in Node table: %s", index + 2, name)
            return False
        else:
            node_set.add(name)

    return True


def valid_data_line(line_num, data_line):
    '''
    Check whether input data line is valid.
        * Generate an error message if the first field (data source) is blank;
        * Generate a warning message if the first field is not found in Sample
          table as ml_data_source;
        * Generate an error message if any of the fields after the first can
          not be converted into float type.
    '''

    data_source = data_line[0]
    if not data_source or data_source.isspace():
        logger.error("Input file line #%d: data_source is blank", line_num)
        return False

    if not Sample.objects.filter(ml_data_source=data_source).exists():
        logger.warn(
            "Input file line #%d: data_source value not found in database: %s",
            line_num, data_source)
    values = data_line[1:]
    for index, value in enumerate(values):
        try:
            float(value)
        except ValueError:
            logger.error("Input file line #%d column #%d: %s can not be "
                         "converted into floating type", line_num, index + 2,
                         value)
            return False
    return True


def valid_activity(file_handler, ml_model_name):
    '''
    Check whether input activity file is valid.

    This function first calls valid_node_names() to check the header line,
    then calls valid_data_line() to check the data lines after the header.
    If any error is detected, it will generate an error message and return
    False; otherwise it will return True.
    '''

    col_num = 0
    for line_index, line in enumerate(file_handler):
        fields = line.rstrip('\n').split('\t')
        if line_index == 0:
            if not valid_node_names(fields[1:], ml_model_name):
                return False
            col_num = len(fields)
        elif len(fields) != col_num:
            logger.error("Input file line #%d: Number of fields is not %d",
                         line_index + 1, col_num)
            return False
        elif not valid_data_line(line_index + 1, fields):
            return False

    return True


def import_activity(file_handler, ml_model_name):
    '''
    Read the data in activity sheet into the database.

    This function first checks whether input ml_model_name is blank; if not,
    it will call valid_activity() to check whether the input file is in valid
    format. If everything is okay, it will then call import_nodes() and
    import_activity_line() to populate the database.
    '''

    # Throw an exception if the command line is:
    #     manage.py import_activity <filename> ""
    # or:
    #     manage.py import_activity <filename> "   "
    # (Other errors in command line arguments are handled by Command class.)
    if not ml_model_name or ml_model_name.isspace():
        raise Exception("Input ML model name is blank")

    if not valid_activity(file_handler, ml_model_name):
        raise Exception("Invalid input activity file")

    # Seek the file back to the beginning to read it again.
    file_handler.seek(0)
    nodes = []
    for line_index, line in enumerate(file_handler):
        fields = line.rstrip('\n').split('\t')
        if line_index == 0:
            nodes = fields[1:]
            import_nodes(nodes, ml_model_name)
        else:
            import_activity_line(nodes, fields)


def import_nodes(node_names, ml_model_name):
    ''' Load node_names on the header line into "Node" table. '''
    mlmodel, created = MLModel.objects.get_or_create(title=ml_model_name)
    for name in node_names:
        Node.objects.create(name=name, mlmodel=mlmodel)


def import_activity_line(node_names, data_line):
    ''' Load the input data_line into "Activity" table. '''

    data_source = data_line[0]
    try:
        sample = Sample.objects.get(ml_data_source=data_source)
    # If data_source is not found in "Sample" table, valid_activity() will
    # have generated a warning message, so here we skip the data line silently.
    except Sample.DoesNotExist:
        return

    values = data_line[1:]
    records = []
    for node_name, value in zip(node_names, values):
        node = Node.objects.get(name=node_name)
        records.append(Activity(sample=sample, node=node, value=float(value)))
    Activity.objects.bulk_create(records)