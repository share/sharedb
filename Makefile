.PHONY: all clean

all:
	coffee -bc lib

clean:
	rm lib/*.js

