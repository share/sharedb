.PHONY: all clean

all:
	coffee -bcm lib

clean:
	rm lib/*.js

