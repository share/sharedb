.PHONY: all clean

all:
	coffee -bcm lib

watch:
	coffee -bcmw lib

clean:
	rm lib/*.js

