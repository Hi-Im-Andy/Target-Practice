'''
Used to create logs of the program being run.
'''

import os
import logging
from logging.handlers import RotatingFileHandler

def make_log():
    '''
    Creates the log and/or allows for appending to the log.

    Args: 
        None

    Returns:
        logger (var): The pointer variable to the log file.
    '''

    logger = logging.getLogger(__name__)
    path = os.path.dirname(__file__)
    log_filename = os.path.join(path, "program.log")

    logger.setLevel(logging.DEBUG)
    formatter = logging.Formatter(
       fmt = "%(asctime)s: %(levelname)-8s %(message)s", datefmt = "%d/%m/%Y %H:%M:%S"
    )

    file_handler = RotatingFileHandler(
        filename = log_filename,
        mode = 'a',
        maxBytes = 1024 * 1024,
        backupCount = 1,
        encoding = None,
        delay = 0
    )

    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    stream_handler = logging.StreamHandler()
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)
    return logger

#############################################################
# If Main Test
#############################################################
if (__name__ == "__main__"):
    logger = make_log()
    logger.info("This is a test message run from Logger.py.")