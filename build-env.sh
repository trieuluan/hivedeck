# Build environment for this VM (no sudo; libsqlite3-dev + libclang extracted locally)
export PATH="$HOME/.cargo/bin:$PATH"
export LIBSQLITE3_SYS_USE_PKG_CONFIG=1
export PKG_CONFIG_PATH=/home/dendro/.local/build-deps/extract/usr/lib/x86_64-linux-gnu/pkgconfig
export LIBCLANG_PATH=/home/dendro/.local/build-deps/libclang-shim
export BINDGEN_EXTRA_CLANG_ARGS="-resource-dir /home/dendro/.local/build-deps/libclang-shim/lib/clang/21"
