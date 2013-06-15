.PHONY: all clean

all:
	node_modules/.bin/coffee -bc lib

clean:
	rm lib/*.js

