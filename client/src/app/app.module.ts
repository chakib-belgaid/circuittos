import { BrowserModule } from '@angular/platform-browser';
import { NgModule } from '@angular/core';

import { AppComponent } from './app.component';
import { StoresComponent } from './stores/stores.component';
import {StoresService1} from './stores.service';
import {HttpModule} from '@angular/http';
import { CircuitComponent } from './circuit/circuit.component';
import { StaticCircuitDesignerComponent } from './static-circuit-designer/static-circuit-designer.component';
import {CircuitsService} from './circuits.service';
import { StaticCircuitChallangerComponent } from './static-circuit-challanger/static-circuit-challanger.component';
import {RouterModule, Routes} from '@angular/router';

const route: Routes = [
  {path : 'designer/:id' ,
component: StaticCircuitDesignerComponent
  }
  ,
  {
    path : 'challanger/:id' ,
    component : StaticCircuitChallangerComponent
  }
  , {path : 'designer' ,
component: StaticCircuitDesignerComponent
  }

];

@NgModule({
  declarations: [
    AppComponent,
    StoresComponent,
    CircuitComponent,
    StaticCircuitDesignerComponent,
    StaticCircuitChallangerComponent,
  ],
  imports: [
    BrowserModule, HttpModule,
    RouterModule.forRoot(
      route
    )
  ],
  providers: [
    {provide : StoresService1 ,
      useClass: StoresService1,

    },
    {
      provide: CircuitsService  ,
      useClass: CircuitsService  ,
    }
  ],
  bootstrap: [AppComponent]
})
export class AppModule {
}
