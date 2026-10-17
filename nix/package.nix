{
  lib,
  buildNpmPackage,
  ...
}:
let
  productionLib = lib.fileset.difference ../lib (
    lib.fileset.fileFilter (file: lib.hasInfix ".test." file.name) ../lib
  );

  src = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../app
      ../bin
      ../components
      ../hooks
      productionLib
      ../public
      ../scripts

      ../instrumentation.ts
      ../instrumentation.node.ts
      ../next.config.ts
      ../package.json
      ../package-lock.json
      ../postcss.config.mjs
      ../tailwind.config.ts
      ../tsconfig.json
      ../proxy.ts
    ];
  };
  version = (builtins.fromJSON (builtins.readFile ../package.json)).version;
in
buildNpmPackage (finalAttrs: {
  pname = "ompweb";
  inherit src version;

  npmDepsHash = "sha256-sWlf6K96SKtjdaX5EWwoIT28r46QM17hd/o0qW8hSyY=";

  # npmPackFlags = [ "--ignore-scripts" ];

  meta = {
    description = "Local web UI for the oh-my-pi (omp) coding agent";
    license = lib.licenses.mit;
  };
})
