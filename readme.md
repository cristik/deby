# Deby

Wrapper around pry-remote, in case you're stuck on ruby 1.9.x.

Currently only works with ruby <= 1.9.3, and requires the following gems to be installed:
- pry
- pry-debugger
- pry-remote

Not yet a full extension, for now in order to be able to debug you'll need to:
1. open the deby workspace
2. launch the "Extension+Server" configuration
3. in the extension host window that was created, open the project that you'll want to debug
4. in the extension host window, add/launch the deby configuration
5. make sure `binding.pry_remote` is added somewhere in the code, and execute that script
