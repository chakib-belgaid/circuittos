import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';

import { AppComponent } from './app.component';
import { StoresComponent } from './stores/stores.component';
import {StoresService1} from './stores.service';
import {HttpModule} from '@angular/http';
import { CircuitComponent } from './circuit/circuit.component';

@NgModule({
  declarations: [
    AppComponent,
    StoresComponent,
    CircuitComponent
  ],
  imports: [
    BrowserModule, HttpModule,
  ],
  providers: [
    {provide : StoresService1 ,
      useClass: StoresService1,

    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule {
}
