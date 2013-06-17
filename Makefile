.PHONY: all clean

NPM_BIN=`npm bin`

all:
	$(NPM_BIN)/coffee -bc lib

clean:
	rm lib/*.js

